/* Mocks the tiny slice of Supabase GoTrue (Auth) that this app actually
   calls: password sign-in/sign-up, refresh, /auth/v1/user, sign-out.
   Returns real GoTrue-shaped JSON so the *unmodified* supabase-js client
   library parses/persists the session exactly as it would against a real
   project - no production code path is special-cased for tests. */

const crypto = require('crypto');

function base64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/* supabase-js decodes the access token client-side (e.g. to read claims
   without a network round trip) - it must be a structurally valid JWT (3
   dot-separated base64url segments), even though nothing in this mock ever
   verifies a signature (session lookup happens via store.sessionsByAccessToken,
   not by decoding this token). An opaque "qa_at_<uuid>" string failed that
   parse ("Expected 3 parts in JWT; got 1", surfaced as a swallowed console
   warning) and made supabase-js discard the persisted session on the very
   next page load - found via a reload smoke test, not guessed upfront. */
function makeFakeJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  return `${base64url(header)}.${base64url(payload)}.qa-mock-signature`;
}

function issueSession(store, user) {
  const nowMs = store.clock.nowMs();
  const expiresIn = 3600;
  const expiresAtSeconds = Math.floor((nowMs + expiresIn * 1000) / 1000);
  const accessToken = makeFakeJwt({
    sub: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: user.user_metadata || {},
    iat: Math.floor(nowMs / 1000),
    exp: expiresAtSeconds,
    session_id: crypto.randomUUID()
  });
  const refreshToken = 'qa_rt_' + crypto.randomUUID();
  const session = {
    userId: user.id,
    email: user.email,
    expiresAtMs: nowMs + expiresIn * 1000
  };
  store.sessionsByAccessToken.set(accessToken, session);
  store.sessionsByRefreshToken.set(refreshToken, accessToken);
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: expiresAtSeconds,
    refresh_token: refreshToken,
    user: authUserJson(store, user)
  };
}

function authUserJson(store, user) {
  const iso = store.clock.nowIso();
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: iso,
    phone: '',
    confirmed_at: iso,
    last_sign_in_at: iso,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: user.user_metadata || {},
    identities: [],
    created_at: iso,
    updated_at: iso
  };
}

function authError(status, message) {
  return { status, json: { message, msg: message, error_description: message, error: message } };
}

function resolveBearerUser(store, headers) {
  const authHeader = String(headers && (headers.authorization || headers.Authorization) || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const session = store.sessionsByAccessToken.get(token);
  if (!session) return null;
  if (session.expiresAtMs < store.clock.nowMs()) return null;
  const user = [...store.authUsersByEmail.values()].find(u => u.id === session.userId);
  return user || null;
}

function handleAuthRequest(store, { method, pathname, searchParams, body, headers }) {
  body = body || {};

  if (pathname === '/auth/v1/signup' && method === 'POST') {
    const email = body.email;
    if (store.authUsersByEmail.has(email)) return authError(422, 'User already registered');
    const user = {
      id: 'qa_user_' + Math.random().toString(36).slice(2, 10),
      email,
      password: body.password,
      user_metadata: (body.data && typeof body.data === 'object') ? body.data : {}
    };
    store.authUsersByEmail.set(email, user);
    return { status: 200, json: issueSession(store, user) };
  }

  if (pathname === '/auth/v1/token' && method === 'POST') {
    const grantType = searchParams.get('grant_type');
    if (grantType === 'password') {
      const user = store.authUsersByEmail.get(body.email);
      if (!user || user.password !== body.password) return authError(400, 'Invalid login credentials');
      return { status: 200, json: issueSession(store, user) };
    }
    if (grantType === 'refresh_token') {
      const accessToken = store.sessionsByRefreshToken.get(body.refresh_token);
      const session = accessToken ? store.sessionsByAccessToken.get(accessToken) : null;
      if (!session) return authError(400, 'Invalid Refresh Token');
      const user = [...store.authUsersByEmail.values()].find(u => u.id === session.userId);
      return { status: 200, json: issueSession(store, user) };
    }
    return authError(400, 'Unsupported grant_type');
  }

  if (pathname === '/auth/v1/user' && method === 'GET') {
    const user = resolveBearerUser(store, headers);
    if (!user) return authError(401, 'Invalid session');
    return { status: 200, json: authUserJson(store, user) };
  }

  if (pathname === '/auth/v1/logout' && method === 'POST') {
    const authHeader = String(headers && (headers.authorization || headers.Authorization) || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const session = store.sessionsByAccessToken.get(token);
    if (session) store.sessionsByAccessToken.delete(token);
    return { status: 204, json: null };
  }

  return { status: 404, json: { message: 'not_found' } };
}

module.exports = { handleAuthRequest, resolveBearerUser, issueSession, authUserJson };
