/* Generic helper to invoke a REAL, unmodified api/*.js Vercel handler
   in-process against the mock backend, instead of hand-writing a second
   copy of its logic. Used for every /api/* route the static+mock server
   needs to serve (claim-idle-offline-progress, active-daily-event,
   twitch-live, ...) - see offline-progress-handler.js's header comment for
   the full rationale (route interception, not modification). */

const { route } = require('./router');

function buildMockFetch(store) {
  return async function mockFetch(url, options = {}) {
    const method = options.method || 'GET';
    const headers = {};
    if (options.headers) {
      Object.keys(options.headers).forEach(k => { headers[k.toLowerCase()] = options.headers[k]; });
    }
    let parsedBody;
    if (options.body) {
      parsedBody = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    }
    const result = route(store, { method, url, headers, body: parsedBody });
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.json,
      text: async () => JSON.stringify(result.json)
    };
  };
}

function buildMockDateClass(store) {
  return class MockDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(store.clock.nowMs());
      else super(...args);
    }
    static now() { return store.clock.nowMs(); }
  };
}

async function invokeVercelHandler(handlerModulePath, store, { method, headers, body, query }) {
  // eslint-disable-next-line global-require
  const realHandler = require(handlerModulePath);
  const originalFetch = global.fetch;
  const originalDate = global.Date;
  global.fetch = buildMockFetch(store);
  global.Date = buildMockDateClass(store);
  try {
    return await new Promise((resolve, reject) => {
      const fakeRes = {
        statusCode: 200,
        _headers: {},
        setHeader(name, value) { this._headers[name] = value; },
        end(payload) {
          try {
            resolve({ status: this.statusCode, json: payload ? JSON.parse(payload) : null });
          } catch (err) {
            reject(err);
          }
        }
      };
      const fakeReq = { method: method || 'GET', headers: headers || {}, body: body || {}, query: query || {} };
      Promise.resolve(realHandler(fakeReq, fakeRes)).catch(reject);
    });
  } finally {
    global.fetch = originalFetch;
    global.Date = originalDate;
  }
}

module.exports = { invokeVercelHandler };
